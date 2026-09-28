import { MyTaxResponse, TaxRegisterResponse } from "./tax.model";

export interface ITaxService {
  getMyTax(actorId: number, targetEmployeeId?: number): Promise<MyTaxResponse>;

  /** Every employee's tax in one table. Admin only — enforced in the service. */
  getCompanyRegister(actorId: number): Promise<TaxRegisterResponse>;
}
