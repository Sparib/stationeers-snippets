import json as json_lib
import asyncio, aiohttp

async def get():
	async with aiohttp.ClientSession() as session:
		async with session.get("https://data.stationeering.com/recipes/beta.json") as resp:
			return await resp.json()

json = asyncio.get_event_loop().run_until_complete(get())

out_dict = {"items": [], "ingredients": []}

for recipe in json["recipes"]:
	# print(recipe)
	if recipe["item"] not in out_dict["items"]: out_dict["items"].append(recipe["item"])
	for ingred in recipe["ingredients"]:
		if ingred not in list(out_dict["ingredients"]): out_dict["ingredients"].append(ingred)

out = open("new_list.ts", 'w')

out.write(f"export const list = {json_lib.dumps(out_dict)};")
