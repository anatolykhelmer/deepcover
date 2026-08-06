function Injectable(): ClassDecorator { return () => {}; }

class Repository {
  async findAll(): Promise<any[]> { return []; }
  async findById(id: string): Promise<any> { return {}; }
  async save(item: any): Promise<any> { return item; }
}

@Injectable()
export class ItemService {
  constructor(private readonly repo: Repository) {}

  async getAll(): Promise<any[]> {
    return this.repo.findAll();
  }

  async getById(id: string): Promise<any> {
    const item = await this.repo.findById(id);
    if (!item) throw new Error('Not found');
    return item;
  }

  async create(data: any): Promise<any> {
    return this.repo.save(data);
  }
}
