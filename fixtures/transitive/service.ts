function Injectable(): ClassDecorator { return () => {}; }

class OrderRepository {
  async findAll(): Promise<any[]> { return []; }
  async findById(id: string): Promise<any> { return {}; }
  async save(item: any): Promise<any> { return item; }
}

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  async getOrders(): Promise<any[]> {
    return this.repo.findAll();
  }

  async createOrder(data: any): Promise<any> {
    return this.repo.save(data);
  }
}
