import { PublicRequestError } from "../lib/public-request-error.js";

export function resourceQuotaError(error:{code?:string;message:string}) {
  if(error.code!=="P0001")return undefined;
  const messages:Record<string,string>={
    "Room ownership limit reached":"Your room limit is reached. Remove an unused room before creating another.",
    "Room waiting queue limit reached":"This room's waiting queue is full. Remove tracks before adding more.",
    "Account waiting queue limit reached":"Your waiting queues are full. Remove tracks before adding more.",
    "Saved picks limit reached":"Your saved picks are full. Delete a pick before saving another.",
    "Saved sets limit reached":"Your saved sets are full. Delete a set before saving another.",
    "Set tracks limit reached":"This set has reached its track limit. Remove tracks before adding more.",
  };
  return Object.hasOwn(messages,error.message)?new PublicRequestError(messages[error.message],429):undefined;
}
