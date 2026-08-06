function Injectable(): ClassDecorator {
  return () => {};
}

class DbService {
  async find(query: any): Promise<any[]> { return []; }
  async findById(id: string): Promise<any> { return {}; }
  async save(doc: any): Promise<any> { return doc; }
}

class Logger {
  error(msg: string): void {}
  info(msg: string): void {}
}

type OrderStatus = 'pending' | 'processing' | 'completed' | 'cancelled';

@Injectable()
export class BranchingService {
  constructor(
    private readonly db: DbService,
    private readonly logger: Logger,
  ) {}

  // Guard clause (early return)
  async findById(id: string): Promise<any> {
    if (!id) return null;
    return this.db.findById(id);
  }

  // Switch statement
  async processOrder(orderId: string, status: OrderStatus): Promise<string> {
    switch (status) {
      case 'pending':
        return 'waiting';
      case 'processing':
        await this.db.save({ orderId, status });
        return 'saved';
      case 'completed':
        this.logger.info(`Order ${orderId} completed`);
        return 'done';
      case 'cancelled':
        this.logger.error(`Order ${orderId} cancelled`);
        return 'cancelled';
      default:
        throw new Error(`Unknown status: ${status}`);
    }
  }

  // Try-catch with if/else inside
  async safeSave(doc: any): Promise<{ success: boolean; error?: string }> {
    try {
      if (doc.validated) {
        await this.db.save(doc);
        return { success: true };
      } else {
        return { success: false, error: 'not validated' };
      }
    } catch (error) {
      this.logger.error(String(error));
      return { success: false, error: String(error) };
    }
  }

  // Ternary
  getLabel(active: boolean): string {
    return active ? 'Active' : 'Inactive';
  }

  // Multiple external calls
  async transferOrder(fromId: string, toId: string): Promise<void> {
    const source = await this.db.findById(fromId);
    const target = await this.db.findById(toId);
    if (!source || !target) {
      throw new Error('Not found');
    }
    await this.db.save({ ...target, items: source.items });
    this.logger.info(`Transferred ${fromId} to ${toId}`);
  }
}
