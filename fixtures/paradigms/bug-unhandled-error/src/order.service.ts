export interface Order {
  id: string;
  amount: number;
  status: string;
}

export interface OrderRepository {
  save(order: Order): Promise<Order>;
  findById(id: string): Promise<Order | null>;
}

export class OrderService {
  constructor(private readonly repository: OrderRepository) {}

  async createOrder(amount: number): Promise<Order> {
    try {
      const order: Order = { id: 'new', amount, status: 'created' };
      return await this.repository.save(order);
    } catch (error) {
      throw new Error(`Failed to create order: ${(error as Error).message}`);
    }
  }
}
