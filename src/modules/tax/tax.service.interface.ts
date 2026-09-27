import { MyTaxResponse } from "./tax.model";

export interface ITaxService {
  getMyTax(actorId: number, targetEmployeeId?: number): Promise<MyTaxResponse>;
}
