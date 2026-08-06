// Fixture: simple NestJS-like service for testing
function Injectable(): ClassDecorator {
  return () => {};
}

class HttpService {
  async get(url: string): Promise<any[]> {
    return [];
  }
}

enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

class StatusBar {
  render(): string {
    return 'bar';
  }
}

interface Item {
  id: string;
  status: Status;
}

@Injectable()
export class SimpleService {
  constructor(private readonly httpService: HttpService) {}

  async findAll(status?: Status): Promise<Item[]> {
    if (status === Status.Active) {
      return this.httpService.get('/items?active=true');
    }
    return this.httpService.get('/items');
  }

  getVersion(): string {
    return '1.0.0';
  }

  // Uses StatusBar (substring of Status) - should NOT be in Status enum's affectedMethods
  getStatusBarInfo(statusBar: StatusBar): string {
    return statusBar.render();
  }
}
