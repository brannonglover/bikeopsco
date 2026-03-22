/** Format a customer's full display name from firstName and lastName */
export function formatCustomerName(c: {
  firstName: string;
  lastName: string | null;
}): string {
  return c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
}
