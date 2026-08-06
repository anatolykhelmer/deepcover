export interface LLMProvider {
  analyze(system: string, user: string): Promise<string>;
}
