function Controller(): ClassDecorator { return () => {}; }

class OrderService {
  async getOrders(): Promise<any[]> { return []; }
  async createOrder(data: any): Promise<any> { return data; }
}

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  async list(): Promise<any[]> {
    return this.orderService.getOrders();
  }

  async create(body: any): Promise<any> {
    return this.orderService.createOrder(body);
  }
}
