import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import type { Prompt } from '../types';

export function usePrompts() {
  return useQuery<Prompt[]>({
    queryKey: ['prompts'],
    queryFn: async () => {
      // Throw on any failure so React Query's retry machinery kicks in —
      // previously we swallowed errors and cached [] for 30s, which meant the
      // prompts list stayed empty after a refresh if the bridge hadn't yet
      // reconnected on first render.
      const res = await rpc('prompt.list');
      if (!res.ok || !Array.isArray(res.prompts)) {
        throw new Error(typeof res.error === 'string' ? res.error : 'prompt.list failed');
      }
      return res.prompts as Prompt[];
    },
    staleTime: 5_000,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });
}

export function useAddPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, prompt }: { label: string; prompt: string }) => {
      await rpc('prompt.add', { label, prompt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}

export function useRemovePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await rpc('prompt.remove', { id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}

export function useUpdatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oldId, label, prompt }: { oldId: string; label: string; prompt: string }) => {
      await rpc('prompt.remove', { id: oldId });
      await rpc('prompt.add', { label, prompt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}
