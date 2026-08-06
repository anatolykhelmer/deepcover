function Injectable(): ClassDecorator { return () => {}; }

@Injectable()
export class OrderRepository {
  async findAll(): Promise<any[]> { return []; }
  async findById(id: string): Promise<any> { return {}; }
  async save(item: any): Promise<any> { return item; }
}
