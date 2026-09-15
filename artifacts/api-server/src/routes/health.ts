import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getArchivedSessionSettings } from "../lib/archived-session-settings";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const { retentionDays, cleanupIntervalMinutes } =
    getArchivedSessionSettings();
  const data = HealthCheckResponse.parse({
    status: "ok",
    archivePolicy: {
      retentionDays,
      cleanupIntervalMinutes,
    },
  });
  res.json(data);
});

export default router;
