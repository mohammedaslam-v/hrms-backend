/** A person as the organisation structure sees them. */
export interface TeamMember {
  id: number;
  employeeCode: string;
  fullName: string;
  designation: string | null;
}
