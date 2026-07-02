import { getAllIpos } from "@/lib/repository";
import { IpoListClient } from "@/components/IpoListClient";

export default function HomePage() {
  const ipos = getAllIpos();
  return <IpoListClient ipos={ipos} />;
}
