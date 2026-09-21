import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { ProjectsController } from "./projects.controller";

export const createProjectsRouter = (controller: ProjectsController): Router => {
  const router = Router();
  router.use(requireAuth);

  router.patch("/tasks/:taskId", controller.updateTask);
  router.delete("/tasks/:taskId", controller.deleteTask);

  router.post("/:employeeId", controller.add);
  router.patch("/:projectId", controller.update);
  router.delete("/:projectId", controller.delete);
  router.post("/:projectId/tasks", controller.addTask);

  return router;
};
