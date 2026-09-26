import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Navigation, Clock, AlertTriangle, ArrowRight, CheckCheck, Loader2 } from 'lucide-react';
import api from '../api/client';
import { GlassCard } from '../components/ui';
import { useNavigate } from 'react-router-dom';
import { resolveMissionRoute } from '../lib/missionResolver';

export default function Notifications() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [acceptingId, setAcceptingId] = useState<string | number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data,
    refetchInterval: 12000
  });

  const notifications: any[] = data?.notifications || [];
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = async () => {
    try {
      await api.post('/notifications/dismiss-all');
      queryClient.setQueryData(['notifications'], (old: any) => ({
        ...old,
        notifications: (old?.notifications || []).map((n: any) => ({ ...n, read: true }))
      }));
    } catch (e) {
      console.error('Failed to dismiss notifications', e);
    }
  };

  const handleAcceptMission = async (n: any, index: number) => {
    const notifId = n.id || `notif-${index}`;
    setAcceptingId(notifId);

    const currentCity = localStorage.getItem('quantara_city') || 'Pune';
    const routeInfo = resolveMissionRoute(n, currentCity);

    // Optimistically mark as read in local cache
    queryClient.setQueryData(['notifications'], (old: any) => ({
      ...old,
      notifications: (old?.notifications || []).map((item: any, i: number) =>
        (item.id === n.id || i === index) ? { ...item, read: true } : item
      )
    }));

    // Fire background updates without blocking navigation
    if (n.id) {
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
    }
    api.post('/fleet/citizen/status', { status: 'ACCEPTED' }).catch(() => {});

    // Sync city across app
    if (routeInfo.city) {
      localStorage.setItem('quantara_city', routeInfo.city);
      window.dispatchEvent(new CustomEvent('quantara:city-change', { detail: { city: routeInfo.city } }));
    }

    // Brief timeout for user feedback before navigation
    setTimeout(() => {
      navigate('/dashboard', {
        state: {
          routeOverride: routeInfo
        }
      });
    }, 200);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 flex justify-center w-full relative z-10">
      <div className="w-full max-w-4xl mt-16 md:mt-0 space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl lg:text-3xl font-semibold flex items-center gap-3">
              <span className="p-2 rounded-xl bg-accent/10 border border-accent/20 text-accent">
                <Bell size={22} />
              </span>
              Notifications & Mission Alerts
              {unreadCount > 0 && (
                <span className="text-xs bg-accent text-slate-950 font-bold px-2 py-0.5 rounded-full ml-1 animate-pulse">
                  {unreadCount} new
                </span>
              )}
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Live operational dispatches, emergency clearance routes, and system updates.
            </p>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="self-start sm:self-auto text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center gap-1.5 transition"
            >
              <CheckCheck size={14} className="text-slate-400" />
              Mark all as read
            </button>
          )}
        </div>

        {/* Notifications List */}
        <GlassCard className="p-0 overflow-hidden shadow-2xl border border-slate-800/80">
          {isLoading ? (
            <div className="text-slate-400 p-12 text-center flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <span className="text-xs tracking-wider uppercase">Loading system updates...</span>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-slate-500 p-12 text-center flex flex-col items-center gap-2">
              <CheckCircle2 size={32} className="text-slate-600" />
              <div className="font-medium text-slate-300">All caught up!</div>
              <div className="text-xs">No pending missions or alerts in your operational sector.</div>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {notifications.map((n: any, i: number) => {
                const isMission = n.title?.includes('Mission Assigned') || (n.message && /Route:\s+.+\s+to\s+/i.test(n.message));
                const notifId = n.id || `notif-${i}`;
                const isAccepting = acceptingId === notifId;
                const routeInfo = isMission ? resolveMissionRoute(n) : null;

                return (
                  <div
                    key={notifId}
                    className={`p-5 transition relative ${
                      n.read
                        ? 'bg-slate-900/30 hover:bg-slate-800/30 opacity-80'
                        : 'bg-slate-900/80 hover:bg-slate-800/60 border-l-4 border-l-accent'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                            {isMission && <Navigation size={14} className="text-accent shrink-0" />}
                            {n.title || n.message || 'System Notification'}
                          </span>

                          {n.read ? (
                            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-medium flex items-center gap-1">
                              <CheckCircle2 size={10} /> ACCEPTED / READ
                            </span>
                          ) : isMission ? (
                            <span className="text-[10px] text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded font-mono font-medium flex items-center gap-1">
                              <AlertTriangle size={10} /> ACTION REQUIRED
                            </span>
                          ) : (
                            <span className="text-[10px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded font-mono font-medium">
                              UPDATE
                            </span>
                          )}
                        </div>

                        {/* Route Pills Preview */}
                        {routeInfo && (
                          <div className="flex items-center gap-2 text-xs text-slate-300 mt-2 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 w-fit flex-wrap">
                            <span className="text-[10px] uppercase font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                              {routeInfo.city}
                            </span>
                            <span className="font-medium text-slate-200">{routeInfo.origin}</span>
                            <ArrowRight size={13} className="text-accent shrink-0" />
                            <span className="font-medium text-slate-200">{routeInfo.destination}</span>
                            <span className="text-[10px] text-slate-500 font-mono ml-2 border-l border-slate-800 pl-2">
                              {routeInfo.taskId}
                            </span>
                          </div>
                        )}

                        {(n.message || n.text) && n.title && (
                          <div className="text-xs text-slate-400 font-sans leading-relaxed">
                            {n.message || n.text}
                          </div>
                        )}

                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                          <Clock size={11} />
                          {n.createdAt ? new Date(n.createdAt).toLocaleString() : new Date().toLocaleString()}
                        </div>
                      </div>

                      {/* Action Button */}
                      {isMission && (
                        <div className="sm:self-center shrink-0 mt-2 sm:mt-0">
                          <button
                            disabled={isAccepting}
                            onClick={() => handleAcceptMission(n, i)}
                            className={`text-xs px-4 py-2.5 rounded-xl font-semibold transition flex items-center gap-2 shadow-lg ${
                              isAccepting
                                ? 'bg-accent/70 text-slate-950 cursor-wait'
                                : n.read
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 hover:border-accent/40'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40 hover:scale-[1.02] active:scale-[0.98]'
                            }`}
                          >
                            {isAccepting ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                <span>Loading Route...</span>
                              </>
                            ) : (
                              <>
                                <Navigation size={13} />
                                <span>{n.read ? 'View Route on Map' : 'Accept & View Route'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
