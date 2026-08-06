import { ItemService } from './source';

describe('ItemService', () => {
  let service: any;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findAll: jest.fn().mockResolvedValue([{ id: '1' }]),
      findById: jest.fn().mockResolvedValue({ id: '1' }),
      save: jest.fn().mockResolvedValue({ id: '1' }),
    };
    service = new ItemService(mockRepo);
  });

  it('should get all items', async () => {
    const result = await service.getAll();
    expect(result).toBeDefined();
  });

  it('should get by id', async () => {
    const result = await service.getById('1');
    expect(result).toBeTruthy();
  });

  it('should create', async () => {
    await service.create({ name: 'test' });
    expect(mockRepo.save).toHaveBeenCalled();
  });
});
