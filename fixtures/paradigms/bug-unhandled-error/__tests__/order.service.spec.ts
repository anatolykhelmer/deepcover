import { OrderService } from '../src/order.service';
import type { OrderRepository } from '../src/order.service';

describe('OrderService', () => {
  let service: OrderService;
  let mockRepo: jest.Mocked<OrderRepository>;

  beforeEach(() => {
    mockRepo = {
      save: jest.fn().mockResolvedValue({ id: '1', amount: 100, status: 'created' }),
      findById: jest.fn(),
    };
    service = new OrderService(mockRepo);
  });

  it('should create an order successfully', async () => {
    const result = await service.createOrder(100);
    expect(result).toEqual({ id: '1', amount: 100, status: 'created' });
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });
});
