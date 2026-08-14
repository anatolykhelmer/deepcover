export class OrderService {
  create(input: { customerId: string }): { id: string; customerId: string; status: string } {
    if (!input.customerId) throw new Error('customerId required');
    return { id: 'b-1', customerId: input.customerId, status: 'pending' };
  }
}
