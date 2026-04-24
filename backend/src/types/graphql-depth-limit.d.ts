declare module 'graphql-depth-limit' {
  import type { ValidationRule } from 'graphql';

  export default function depthLimit(maxDepth: number): ValidationRule;
}
