import { ItemService } from './source';

describe('ItemService', () => {
  let service: any;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findAll: jest.fn().mockResolvedValue([{ id: '1', name: 'Item 1' }]),
      findById: jest.fn().mockResolvedValue({ id: '1', name: 'Item 1' }),
      save: jest.fn().mockResolvedValue({ id: '2', name: 'New Item' }),
    };
    service = new ItemService(mockRepo);
  });

  it('should return all items from repository', async () => {
    const result = await service.getAll();
    expect(result).toEqual([{ id: '1', name: 'Item 1' }]);
    expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
  });

  it('should return item by id', async () => {
    const result = await service.getById('1');
    expect(result).toEqual({ id: '1', name: 'Item 1' });
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });

  it('should throw when item not found', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.getById('999')).rejects.toThrow('Not found');
  });

  it('should save item via repository', async () => {
    const data = { name: 'New Item' };
    const result = await service.create(data);
    expect(result).toEqual({ id: '2', name: 'New Item' });
    expect(mockRepo.save).toHaveBeenCalledWith(data);
  });
});
