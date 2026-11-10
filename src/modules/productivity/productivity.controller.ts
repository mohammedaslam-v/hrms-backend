import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { IAuthService } from '../auth/auth.service.interface';
import { IProductivityService } from './productivity.service.interface';

export class ProductivityController {
  constructor(
    private readonly productivityService: IProductivityService,
    private readonly authService: IAuthService,
  ) {}

  /** POST /productivity/settle — admins: decide every due day now, and say what happened. */
  settle = async (req: Request, res: Response): Promise<void> => {
    try {
      const viewerId = (req as AuthenticatedRequest).employeeId;
      if (!viewerId) {
        res.status(401).json({ success: false, message: 'Sign in again.' });
        return;
      }
      const viewer = await this.authService.getCurrentEmployee(viewerId);
      if (!viewer.tiers.includes('admin')) {
        res.status(403).json({ success: false, message: 'Only administrators can run this.' });
        return;
      }
      res.json({ success: true, data: await this.productivityService.settleDue() });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not run the productivity check.' });
    }
  };
}
