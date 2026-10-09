import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { DriverTripError, type DriverTripService } from "./driver-trip-service.js";
import { getRideById } from "./store.js";

export function createDriverTripRouter(service: DriverTripService) {
  const router = express.Router();
  const limit = rateLimit({ windowMs:15*60000, limit:150, standardHeaders:"draft-7", legacyHeaders:false });
  router.use("/api/driver/trips", limit, (_req,res,next) => {
    res.set({ "Cache-Control":"no-store", "Referrer-Policy":"no-referrer", "X-Robots-Tag":"noindex, nofollow" }); next();
  });
  const run = (handler: RequestHandler): RequestHandler => async (req,res,next) => {
    try { await handler(req,res,next); }
    catch(error) { res.status(error instanceof DriverTripError ? error.status : 503).json({error:error instanceof DriverTripError ? error.message : "The trip service is unavailable. Please retry."}); }
  };
  router.get("/api/driver/trips/:token",run(async(req,res)=>{res.json({trip:await service.get(String(req.params.token))});}));
  router.post("/api/driver/trips/:token/status",run(async(req,res)=>{
    const parsed=z.object({status:z.enum(["EN_ROUTE","IN_PROGRESS","COMPLETED"])}).strict().safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:"Choose en route, picked up, or complete."});return;}
    res.json({trip:await service.transition(String(req.params.token),parsed.data.status)});
  }));
  return router;
}

export function createDispatcherCaptureRouter(admin: RequestHandler, capture: (bookingRequestId:string)=>Promise<{id:string;status:string;amount_received?:number}>) {
  const router=express.Router();
  router.post("/api/admin/rides/:id/capture",admin,async(req,res)=>{
    try {
      const ride=await getRideById(String(req.params.id));
      if(!ride || ride.status==="CANCELLED"){res.status(409).json({error:"This ride is unavailable or cancelled."});return;}
      if(!ride.inquiry.bookingRequestId){res.status(409).json({error:"No authorized booking is linked to this ride."});return;}
      const intent=await capture(ride.inquiry.bookingRequestId);
      res.json({paymentIntentId:intent.id,status:intent.status,amountReceived:intent.amount_received});
    } catch(error) {
      res.status(422).json({error:error instanceof Error ? error.message : "Capture could not be confirmed. Retry this same ride."});
    }
  });
  return router;
}
