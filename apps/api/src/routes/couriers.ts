import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listCouriers, createCourier, updateCourier,
  listJobs, createJobForOrder, assignJob, transitionJob,
  courierByToken, courierJobs, courierTransition,
  JOB_STATUSES, type JobStatus,
} from "../services/courier-service.js";

// Entregadores próprios + corridas (ADR-033). `courierRoutes` é protegido (loja);
// `entregadorPublicRoutes` é o app do entregador (acesso por token, sem auth).

const VEHICLES = ["moto", "carro", "bike", "a_pe"] as const;

export const courierRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => listCouriers(req.auth!.tenantId));

  app.post("/", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(), name: z.string().min(1),
      phone: z.string().optional(), vehicle: z.enum(VEHICLES).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    return createCourier(req.auth!.tenantId, body.data);
  });

  app.patch("/:id", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(), name: z.string().optional(),
      phone: z.string().nullable().optional(), vehicle: z.enum(VEHICLES).optional(), active: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try { return await updateCourier(req.auth!.tenantId, (req.params as any).id, body.data); }
    catch (e: any) { return reply.code(404).send({ error: e?.message ?? "não encontrado" }); }
  });

  // Corridas (jobs)
  app.get("/jobs", async (req) => {
    const status = (req.query as any)?.status as string | undefined;
    return listJobs(req.auth!.tenantId, status);
  });

  app.post("/jobs", async (req, reply) => {
    const body = z.object({
      tenantSlug: z.string(), orderId: z.string(),
      courierId: z.string().optional(), feeBRL: z.number().positive().optional(), notes: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try { return await createJobForOrder(req.auth!.tenantId, body.data.orderId, body.data); }
    catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });

  app.patch("/jobs/:id/assign", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), courierId: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try { return await assignJob(req.auth!.tenantId, (req.params as any).id, body.data.courierId); }
    catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });

  app.patch("/jobs/:id/status", async (req, reply) => {
    const body = z.object({ tenantSlug: z.string(), status: z.enum(JOB_STATUSES) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try { return await transitionJob(req.auth!.tenantId, (req.params as any).id, body.data.status as JobStatus); }
    catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });
};

// ── App do entregador (público, por token) ───────────────────────────────────
export const entregadorPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:token", async (req, reply) => {
    const courier = await courierByToken((req.params as any).token);
    if (!courier || !courier.active) return reply.code(404).send({ error: "acesso inválido" });
    const jobs = await courierJobs(courier.id);
    return { courier: { name: courier.name, vehicle: courier.vehicle }, jobs };
  });

  app.post("/:token/jobs/:jobId/:action", async (req, reply) => {
    const { token, jobId, action } = req.params as any;
    const map: Record<string, JobStatus> = { aceitar: "aceito", coletar: "coletado", entregar: "entregue" };
    const to = map[action];
    if (!to) return reply.code(400).send({ error: "ação inválida" });
    try { return await courierTransition(token, jobId, to); }
    catch (e: any) { return reply.code(400).send({ error: e?.message ?? "falha" }); }
  });
};
