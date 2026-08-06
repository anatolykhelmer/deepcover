import { UserData } from './user-data';

export class UserService {
  createUser(name: string, email: string, age: number): UserData {
    const user = new UserData();
    user.setName(name);
    user.setEmail(email);
    user.setAge(age);
    return user;
  }

  formatUser(user: UserData): string {
    return `${user.getName()} <${user.getEmail()}>, age ${user.getAge()}`;
  }
}
