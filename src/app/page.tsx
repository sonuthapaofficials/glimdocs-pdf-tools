import { redirect } from "next/navigation";

// This repo is the free PDF tools. The root URL forwards to the catalog.
export default function Home() {
  redirect("/free-tools");
}
