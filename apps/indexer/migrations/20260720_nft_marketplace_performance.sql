create index if not exists nft_listings_active_collection_price_idx
  on nft_listings (chain_id, collection, unit_price)
  where cancelled = false and remaining_quantity > 0;

create index if not exists nft_listings_active_item_updated_idx
  on nft_listings (chain_id, collection, token_id, updated_at desc)
  where cancelled = false and remaining_quantity > 0;

create index if not exists nft_items_collection_token_idx
  on nft_items (chain_id, collection, token_id);
