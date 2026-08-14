export class OrderService {
  create(input: { sku: string; qty: number }): { id: string; sku: string; qty: number } {
    if (!input.sku) throw new Error('sku required');
    return { id: 'a-1', sku: input.sku, qty: input.qty };
  }
}
