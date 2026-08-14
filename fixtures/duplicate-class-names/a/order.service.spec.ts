import { OrderService } from './order.service';

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(() => {
    service = new OrderService();
  });

  it('should create order', () => {
    const result = service.create({ sku: 'ABC', qty: 2 });
    expect(result).toEqual({ id: 'a-1', sku: 'ABC', qty: 2 });
  });

  it('should throw when sku missing', () => {
    expect(() => service.create({ sku: '', qty: 1 })).toThrow('sku required');
  });
});
