import { Router } from "express";
import { TaxController } from "./tax.controller";
import { requireAuth } from "../../middlewares/auth.middleware";

export const createTaxRouter = (controller: TaxController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get("/me", controller.getMyTax);

  // Declared BEFORE "/:id" or the wildcard swallows it — "register" would be
  // read as an employee id and the page would 404 with no clue why.
  router.get("/register", controller.getCompanyRegister);
  router.get("/:id", controller.getEmployeeTax);

  return router;
};
