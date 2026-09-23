import { Router } from "express";
import { SalaryController } from "./salary.controller";
import { requireAuth } from "../../middlewares/auth.middleware";

export const createSalaryRouter = (controller: SalaryController): Router => {
  const router = Router();

  router.use(requireAuth);

  router.get("/me", controller.getMySalary);
  router.get("/:id", controller.getEmployeeSalary);

  return router;
};
