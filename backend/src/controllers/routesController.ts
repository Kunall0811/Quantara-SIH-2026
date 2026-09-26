import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { AuthedRequest } from '../middleware/auth';
import { calculateRoute, calculateRouteThrough } from '../services/routingManager';
import { getStore } from '../store';

const pointSchema=z.object({lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),label:z.string().optional()});
export const calculate=asyncHandler(async(req:AuthedRequest,res:Response)=>{const b=z.object({origin:pointSchema,destination:pointSchema}).parse(req.body);res.json(await calculateRoute(b.origin,b.destination));});
export const calculateThrough=asyncHandler(async(req:AuthedRequest,res:Response)=>{const b=z.object({points:z.array(pointSchema).min(2).max(30)}).parse(req.body);res.json(await calculateRouteThrough(b.points));});
const saveSchema=z.object({name:z.string().default('Saved route'),origin:pointSchema,destination:pointSchema,waypoints:z.array(pointSchema).default([]),vehicle:z.object({type:z.enum(['car','truck','ambulance','delivery','bus','two_wheeler']).default('car'),maxSpeedKmph:z.number().default(80),fuelEfficiencyKmPerL:z.number().default(15),fuelType:z.enum(['petrol','diesel','electric','cng']).default('petrol'),capacityKg:z.number().default(500),priority:z.enum(['normal','high','emergency']).default('normal')}).default({} as any)});
export const save=asyncHandler(async(req:AuthedRequest,res:Response)=>{const body=saveSchema.parse(req.body);const saved=await getStore().saveRoute({...body,userId:req.user?.sub||null,vehicle:{id:'inline',...body.vehicle} as any});res.json({success:true,route:saved});});
export const history=asyncHandler(async(req:AuthedRequest,res:Response)=>res.json({success:true,routes:await getStore().listSavedRoutes(req.user?.sub||null)}));
export const getById=asyncHandler(async(req:AuthedRequest,res:Response)=>{const result=await getStore().getOptimizationResult(req.params.id);if(!result)throw new ApiError(404,'Route/result not found','NOT_FOUND');res.json({success:true,result});});
