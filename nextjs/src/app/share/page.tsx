import Head from 'next/head'
import SharePageCSR from './pageCSR'

export const metadata = {
    title: "Conrad's Crossword",
    description: 'Daily puzzles',
    openGraph: {
        images: [
            { url: "https://conradscrossword.com/icon.svg" }
        ]
    }
}

export default async function SharePage() {
    return (
        <>
        <div hidden>Server-rendered!</div>
        <SharePageCSR/>
      </>
    )
}