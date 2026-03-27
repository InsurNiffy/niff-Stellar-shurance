'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, Shield, TrendingUp, Users } from 'lucide-react'
import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
            Decentralized Insurance for the
            <span className="text-blue-600"> Stellar Network</span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Parametric insurance powered by DAO governance. Get coverage for smart contract risks with transparent, community-driven claim voting.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button size="lg" className="w-full sm:w-auto text-lg px-8 py-4" asChild>
              <Link href="/quote">
                Get Quote <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto text-lg px-8 py-4" asChild>
              <Link href="#how-it-works">
                Learn More
              </Link>
            </Button>
            <Button variant="ghost" size="lg" className="w-full sm:w-auto text-lg px-8 py-4" asChild>
              <Link href="/docs">
                Documentation
              </Link>
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            <div className="text-center">
              <div className="bg-blue-100 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Shield className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Smart Contract Coverage</h3>
              <p className="text-gray-600 text-sm">Protect your DeFi protocols and smart contracts from unexpected failures</p>
            </div>
            <div className="text-center">
              <div className="bg-green-100 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Users className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">DAO Governance</h3>
              <p className="text-gray-600 text-sm">Community-driven claim validation through transparent voting</p>
            </div>
            <div className="text-center">
              <div className="bg-purple-100 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <TrendingUp className="h-8 w-8 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Stellar Integration</h3>
              <p className="text-gray-600 text-sm">Fast, low-cost transactions on the Stellar blockchain</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
