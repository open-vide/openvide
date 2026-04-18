import { z } from 'zod';

export const addHostSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  url: z.string().url('Must be a valid URL'),
  token: z.string().optional(),
});

export type AddHostInput = z.infer<typeof addHostSchema>;

export const createWorkspaceSchema = z.object({
  cwd: z.string().min(1, 'Working directory is required'),
  tool: z.enum(['claude', 'codex']),
  model: z.string().optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const addPromptSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  prompt: z.string().min(1, 'Prompt text is required'),
});

export type AddPromptInput = z.infer<typeof addPromptSchema>;
