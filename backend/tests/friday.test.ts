import { IntentClassifier, extractSlots } from '../src/friday/classifier';
import { TRAINING, HELD_OUT } from '../src/friday/trainingData';

describe('FRIDAY on-device intent classifier', () => {
  const clf = new IntentClassifier(TRAINING);
  test('held-out paraphrases are classified with ≥ 85% accuracy', () => {
    let ok = 0; const wrong: string[] = [];
    for (const e of HELD_OUT) { const r = clf.classify(e.text); if (r.tool === e.tool) ok++; else wrong.push(`${e.text} → ${r.tool} (want ${e.tool})`); }
    const acc = ok / HELD_OUT.length;
    if (acc < 0.85) console.log(wrong.join('\n'));
    expect(acc).toBeGreaterThanOrEqual(0.85);
  });
  test('training utterances themselves are recovered exactly', () => {
    const bad = TRAINING.filter((e) => clf.classify(e.text).tool !== e.tool);
    expect(bad.map((b) => b.text)).toEqual([]);
  });
  test('nonsense does not match anything confidently', () => { expect(clf.classify('asdkjhaskjdh qwpoeiru').score).toBeLessThan(0.3); });
  test('slot extraction: road code, vehicle, percent, weather, algorithms, event type', () => {
    expect(extractSlots('What happens if Road R-142 closes?')).toMatchObject({ road: 'R-142', eventType: 'ROAD_CLOSURE' });
    expect(extractSlots('what if traffic increases by 40 percent')).toMatchObject({ percent: 40, eventType: 'TRAFFIC_INCREASE' });
    expect(extractSlots('what if q-2 breaks down')).toMatchObject({ vehicleId: 'Q-02', eventType: 'VEHICLE_BREAKDOWN' });
    expect(extractSlots('simulate heavy rain')).toMatchObject({ condition: 'Heavy Rain', eventType: 'WEATHER_CHANGE' });
    expect(extractSlots('compare qpso and pso').algorithms).toEqual(['QPSO', 'PSO']);
    expect(extractSlots('is adaptive qpso better than qpso').algorithms).toEqual(['AQPSO', 'QPSO']);
    expect(extractSlots('accident on Baner Road')).toMatchObject({ road: 'Baner Road', eventType: 'ACCIDENT' });
    expect(extractSlots('pause the demo').demoAction).toBe('pause');
  });
});
