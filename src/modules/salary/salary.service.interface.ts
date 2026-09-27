import { MySalaryView } from "./salary.model";

export interface ISalaryService {
  getMySalary(viewerId: number, subjectId: number, monthKey?: string): Promise<MySalaryView>;
}
