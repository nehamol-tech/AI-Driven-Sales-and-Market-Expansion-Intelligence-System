import express, { type Application } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.middleware.js";
import authRoutes from "./modules/auth/auth.routes.js";
import companyRoutes from "./modules/company/company.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import salesRoutes from "./modules/sales/sales.routes.js";
import geographyRoutes from "./modules/geography/geography.routes.js";
import industriesRoutes from "./modules/industries/industries.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import leadsRoutes from "./modules/leads/leads.routes.js";
import salesAgentRoutes from "./modules/sales-agent/sales-agent.routes.js";
import assistantRoutes from "./modules/assistant/assistant.routes.js";
import opportunitiesRoutes from "./modules/opportunities/opportunities.routes.js";
import marketExpansionRoutes from "./modules/market-expansion/market-expansion.routes.js";
import followUpsRoutes from "./modules/follow-ups/follow-ups.routes.js";
import revenueAnalyticsRoutes from "./modules/revenue-analytics/revenue-analytics.routes.js";
import advertisingRoutes from "./modules/advertising/advertising.routes.js";
import distributorsRoutes from "./modules/distributors/distributors.routes.js";
import optimizationRoutes from "./modules/optimization/optimization.routes.js";
import fmsRoutes from "./modules/fms/fms.routes.js";

export function createApp(): Application {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/company", companyRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/sales", salesRoutes);
  app.use("/api", geographyRoutes);
  app.use("/api", industriesRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/leads", leadsRoutes);
  app.use("/api/sales-agent", salesAgentRoutes);
  app.use("/api/sales-agent/opportunities", opportunitiesRoutes);
  app.use("/api/sales-agent/market-expansion", marketExpansionRoutes);
  app.use("/api/assistant", assistantRoutes);
  app.use("/api/follow-ups", followUpsRoutes);
  app.use("/api/revenue-analytics", revenueAnalyticsRoutes);
  app.use("/api/advertising", advertisingRoutes);
  app.use("/api/distributors", distributorsRoutes);
  app.use("/api/optimization", optimizationRoutes);
  app.use("/api/fms", fmsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
