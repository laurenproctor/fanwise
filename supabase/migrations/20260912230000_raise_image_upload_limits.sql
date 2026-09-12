-- Workspace icons and public profile avatars: 2 MiB to 4 MiB.
--
-- Both are posted to a server action, so the ceiling is the request body a
-- deployment accepts, not storage: Vercel refuses bodies over 4.5 MB, and
-- next.config.ts sets the server action limit just under that. 4 MiB leaves
-- room for multipart overhead and the form's other fields.
--
-- The bucket limit is the last check, behind MAX_ICON_BYTES and
-- MAX_AVATAR_BYTES, and the three must agree or a file the page accepts is
-- refused by storage with an error the creator cannot act on.

update storage.buckets
   set file_size_limit = 4194304 -- 4 MiB, the limit the settings page states
 where id in ('workspace-icons', 'public-profile-avatars');
