import { Router } from "express";
import { TaxController } from "./tax.controller";
import { requireAuth } from "../../middlewares/auth.middleware";

export const createTaxRouter = (controller: TaxController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get("/me", controller.getMyTax);
  router.get("/:id", controller.getEmployeeTax);

  return router;
};
