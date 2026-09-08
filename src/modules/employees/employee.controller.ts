import { RequestHandler } from 'express';
import { IEmployeeService } from './employee.service.interface';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.model';
import { ApiError } from '../../utils/api-error';
import { asyncHandler } from '../../utils/async-handler';

export class EmployeeController {
  constructor(private readonly employeeService: IEmployeeService) {}

  getAll: RequestHandler = asyncHandler(async (_req, res) => {
    const employees = await this.employeeService.getAllEmployees();
    res.json({ success: true, data: employees });
  });

  getById: RequestHandler = asyncHandler(async (req, res) => {
    const id = this.parseId(req.params.id);
    const employee = await this.employeeService.getEmployeeById(id);
    res.json({ success: true, data: employee });
  });

  create: RequestHandler = asyncHandler(async (req, res) => {
    const dto = this.toCreateDto(req.body);
    const employee = await this.employeeService.createEmployee(dto);
    res.status(201).json({ success: true, data: employee });
  });

  update: RequestHandler = asyncHandler(async (req, res) => {
    const id = this.parseId(req.params.id);
    const dto = this.toUpdateDto(req.body);
    const employee = await this.employeeService.updateEmployee(id, dto);
    res.json({ success: true, data: employee });
  });

  delete: RequestHandler = asyncHandler(async (req, res) => {
    const id = this.parseId(req.params.id);
    await this.employeeService.deleteEmployee(id);
    res.status(204).send();
  });

  private parseId(raw: string | string[] | undefined): number {
    if (typeof raw !== 'string') {
      throw ApiError.badRequest('id must be a positive integer');
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.badRequest('id must be a positive integer');
    }
    return id;
  }

  private toCreateDto(body: unknown): CreateEmployeeDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const requiredFields = [
      'employeeCode',
      'firstName',
      'lastName',
      'email',
      'dateOfJoining',
    ] as const;

    const missing = requiredFields.filter(
      (field) => typeof b[field] !== 'string' || (b[field] as string).trim() === '',
    );
    if (missing.length > 0) {
      throw ApiError.badRequest(`Missing or invalid fields: ${missing.join(', ')}`);
    }

    return {
      employeeCode: (b.employeeCode as string).trim(),
      firstName: (b.firstName as string).trim(),
      lastName: (b.lastName as string).trim(),
      email: (b.email as string).trim().toLowerCase(),
      phone: typeof b.phone === 'string' ? b.phone.trim() : null,
      department: typeof b.department === 'string' ? b.department.trim() : null,
      designation: typeof b.designation === 'string' ? b.designation.trim() : null,
      dateOfJoining: (b.dateOfJoining as string).trim(),
      status: b.status === 'inactive' ? 'inactive' : 'active',
    };
  }

  private toUpdateDto(body: unknown): UpdateEmployeeDto {
    const b = (body ?? {}) as Record<string, unknown>;
    const dto: UpdateEmployeeDto = {};

    if (typeof b.firstName === 'string') dto.firstName = b.firstName.trim();
    if (typeof b.lastName === 'string') dto.lastName = b.lastName.trim();
    if (typeof b.email === 'string') dto.email = b.email.trim().toLowerCase();
    if (typeof b.phone === 'string' || b.phone === null) dto.phone = b.phone as string | null;
    if (typeof b.department === 'string' || b.department === null) {
      dto.department = b.department as string | null;
    }
    if (typeof b.designation === 'string' || b.designation === null) {
      dto.designation = b.designation as string | null;
    }
    if (typeof b.dateOfJoining === 'string') dto.dateOfJoining = b.dateOfJoining.trim();
    if (b.status === 'active' || b.status === 'inactive') dto.status = b.status;

    if (Object.keys(dto).length === 0) {
      throw ApiError.badRequest('No valid fields provided to update');
    }
    return dto;
  }
}
