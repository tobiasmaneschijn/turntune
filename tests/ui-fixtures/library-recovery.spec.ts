import {expect,test} from '@playwright/test';

test('a corrupt own library can be explicitly cleared without changing queued tracks',async({page})=>{
  let reset=false,writes=0;
  await page.route('**/api/library',route=>{
    if(route.request().method()==='POST') {expect(route.request().postDataJSON()).toEqual({type:'clear-library'});expect(route.request().headers().authorization).toBe('Bearer fixture-access-token');reset=true;writes++;}
    return route.fulfill(reset?{json:{library:{picks:[],sets:[]}}}:{status:409,json:{error:'Your library could not be read. Clear your library to reset it.'}});
  });
  await page.goto('/tests/qol-harness/music.html?scenario=library');
  await page.getByRole('tab',{name:'My picks',exact:true}).click();
  await expect(page.locator('.music-library-content').getByRole('alert')).toContainText('Clear your library');
  const queueCount=await page.evaluate(()=>window.musicQol.snapshot().room.queue.length);
  await page.getByRole('button',{name:'Clear library…',exact:true}).click();
  expect(writes).toBe(0);
  await page.getByRole('button',{name:'Delete all picks and sets',exact:true}).click();
  await expect(page.getByText('Save picks from a track’s menu.',{exact:true})).toBeVisible();
  expect(writes).toBe(1);
  expect(await page.evaluate(()=>window.musicQol.snapshot().room.queue.length)).toBe(queueCount);
});
