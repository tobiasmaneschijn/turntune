import {expect,test} from '@playwright/test';

test('runtime Supabase configuration enables signed images before private rendering with no VITE URL',async({page})=>{
  let configurations=0,storageLoads=0,nonStorageLoads=0;
  await page.route('**/api/config',route=>{configurations++;return route.fulfill({json:{supabase:{url:'https://runtime.supabase.co',anonKey:'fixture-publishable-key'}}});});
  await page.route('https://runtime.supabase.co/**',route=>{
    if(new URL(route.request().url()).pathname.startsWith('/storage/v1/object/')) storageLoads++;
    else nonStorageLoads++;
    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'});
  });
  await page.goto('/tests/image-policy-harness/index.html');
  await expect(page.locator('.avatar[title="Allowed"] img')).toHaveAttribute('src','https://runtime.supabase.co/storage/v1/object/sign/profile-avatars/owner/file?token=fixture');
  await expect(page.locator('.avatar[title="Denied"] img')).toHaveAttribute('src','/avatars/pulse.svg');
  await expect.poll(()=>storageLoads).toBe(1);
  expect(nonStorageLoads).toBe(0);expect(configurations).toBe(1);
});
