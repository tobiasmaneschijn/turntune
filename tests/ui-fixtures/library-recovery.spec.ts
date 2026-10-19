import {expect,test} from '@playwright/test';

test('recover an unreadable private library without deleting queued songs',async({page})=>{
  let reset=false,writes=0;
  await page.route('**/api/library',route=>{
    if(route.request().method()==='POST') {expect(route.request().postDataJSON()).toEqual({type:'clear-library'});expect(route.request().headers().authorization).toBe('Bearer fixture-access-token');reset=true;writes++;}
    return route.fulfill(reset?{json:{library:{picks:[],sets:[]}}}:{status:409,json:{error:'Your library could not be read. Clear your library to reset it.'}});
  });
  await page.goto('/tests/qol-harness/music.html?scenario=library');
  await page.getByRole('tab',{name:'Favorites',exact:true}).click();
  await expect(page.locator('.music-library-content').getByRole('alert')).toContainText('Clear your library');
  const queueCount=await page.evaluate(()=>window.musicQol.snapshot().room.queue.length);
  await page.getByRole('button',{name:'Clear library…',exact:true}).click();
  expect(writes).toBe(0);
  await page.getByRole('button',{name:'Delete all favorites and sets',exact:true}).click();
  await expect(page.getByText('No favorites yet.',{exact:true})).toBeVisible();
  expect(writes).toBe(1);
  expect(await page.evaluate(()=>window.musicQol.snapshot().room.queue.length)).toBe(queueCount);
});
