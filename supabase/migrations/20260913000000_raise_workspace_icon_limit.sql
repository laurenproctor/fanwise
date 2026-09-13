-- Workspace icons: 2 MiB to 4 MiB.
--
-- An icon is posted to a server action, so the ceiling is the request body a
-- deployment accepts, not storage: Vercel refuses bodies over 4.5 MB, and 4 MiB
-- leaves room for multipart overhead and the form's other fields.
-- next.config.ts raises the server action body limit to match.
--
-- The bucket limit is the last check, behind MAX_ICON_BYTES, and the two must
-- agree or a file the page accepts is refused by storage with an error the
-- creator cannot act on. Profile avatars are not touched here: 20260912220000
-- set that bucket to 5 MiB.

update storage.buckets
   set file_size_limit = 4194304 -- 4 MiB, the limit the settings page states
 where id = 'workspace-icons';
