import {createRoot} from 'react-dom/client';
import {getSupabaseClient} from '../../src/supabase';
import {Avatar} from '../../src/components/Avatar';

// Mirror the application: runtime configuration completes before private render.
await getSupabaseClient();
createRoot(document.getElementById('root')!).render(<>
  <Avatar user={{id:'allowed',name:'Allowed',avatarSeed:'allowed',avatarUrl:'https://runtime.supabase.co/storage/v1/object/sign/profile-avatars/owner/file?token=fixture'}} />
  <Avatar user={{id:'denied',name:'Denied',avatarSeed:'denied',avatarUrl:'https://runtime.supabase.co/auth/v1/callback'}} />
</>);
