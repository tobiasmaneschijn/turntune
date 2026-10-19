import {expect,test} from '@playwright/test';

test('view profile artwork with safe fallbacks for unavailable images and external trackers', async({page})=>{
  const id='00000000-0000-4000-8000-000000000001';
  let trackerLoads=0,approvedLoads=0;
  await page.route('https://tracker.invalid/**',route=>{trackerLoads++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});});
  await page.route('https://i.scdn.co/**',route=>{
    if(route.request().url().endsWith('/unavailable')) return route.fulfill({status:404,body:'missing'});
    approvedLoads++;return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
  });
  await page.route('**/api/profiles/*',route=>route.fulfill({json:{profile:{user_id:id,display_name:'Alice',bio:'',handle:'alice',status_text:'',avatar_key:'pulse',avatar_url:'https://tracker.invalid/avatar',avatar_path:null,theme_key:'afterglow',is_app_admin:false,created_at:'2026-01-15T12:00:00Z',updated_at:'2026-07-31T12:00:00Z',favorite_tracks:[
    {provider:'spotify',providerId:'abcdefghijklmnopqrstuv',title:'Untrusted recording',artworkUrl:'https://tracker.invalid/art'},
    {provider:'spotify',providerId:'5bJ1DrEM4hNCafcDd1oxHx',title:'Official recording',artworkUrl:'https://i.scdn.co/image/recording'},
    {provider:'spotify',providerId:'4uLU6hMCjMI75M1A2tKUQC',title:'Unavailable recording',artworkUrl:'https://i.scdn.co/image/unavailable'}
  ]},options:[]}}));
  await page.route('**/api/social',route=>route.fulfill({json:{people:[],shareActivity:false}}));
  await page.goto('/tests/frontend-session-harness/index.html?embedded&spotify');
  await expect(page.getByRole('heading',{name:'Alice',exact:true})).toBeVisible();
  await expect(page.locator('.profile-avatar-wrap img')).toHaveAttribute('src','/avatars/pulse.svg');
  await expect.poll(()=>approvedLoads).toBe(1);
  await expect(page.locator('.profile-song').filter({hasText:'Untrusted recording'}).locator('.track-artwork')).toHaveAttribute('data-artwork-state','fallback');
  await expect(page.locator('.profile-song').filter({hasText:'Unavailable recording'}).locator('.track-artwork')).toHaveAttribute('data-artwork-state','fallback');
  expect(trackerLoads).toBe(0);
  await expect(page.locator('img[src*="tracker.invalid"]')).toHaveCount(0);
});
