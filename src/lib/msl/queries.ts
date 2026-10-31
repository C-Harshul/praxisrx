import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as api from "./api";

export const doctorQuery = queryOptions({
  queryKey: ["doctor"],
  queryFn: api.fetchDoctor,
});

export const patientMixQuery = (code: string | null | undefined) =>
  queryOptions({
    queryKey: ["patientMix", code],
    queryFn: () => (code ? api.fetchPatientMix(code) : Promise.resolve(null)),
  });

export const newslettersQuery = queryOptions({
  queryKey: ["newsletters"],
  queryFn: api.fetchNewsletters,
});

export const newsletterQuery = (id: string) =>
  queryOptions({ queryKey: ["newsletter", id], queryFn: () => api.fetchNewsletter(id) });

export const articleQuery = (id: string) =>
  queryOptions({ queryKey: ["article", id], queryFn: () => api.fetchArticle(id) });

export const bookmarksQuery = queryOptions({
  queryKey: ["bookmarks"],
  queryFn: api.fetchBookmarks,
});

export function useToggleBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ articleId, bookmarked }: { articleId: string; bookmarked: boolean }) => {
      if (bookmarked) await api.removeBookmark(articleId);
      else await api.addBookmark(articleId);
    },
    onSuccess: (_d, v) => {
      toast.success(v.bookmarked ? "Removed from bookmarks" : "Bookmarked");
    },
    onError: () => toast.error("Couldn't update bookmark. Please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });
}
