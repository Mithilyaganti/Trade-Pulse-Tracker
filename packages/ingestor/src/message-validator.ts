import { PriceTick, ValidationResult, IngestorConfig, ErrorType, IngestorError } from './types';

/**
 * Message validator for incoming price tick data
 * Validates format, data types, business rules, and detects anomalies
 */
export class MessageValidator {
  private config: IngestorConfig;
  private lastPrices: Map<string, number> = new Map(); // Track last prices for deviation detection

  constructor(config: IngestorConfig) {
    this.config = config;
  }

  /**
   * Parse and validate a raw TCP message
   * Expected format: RIC|PRICE|TIMESTAMP|VOLUME|BID|ASK
   * Example: AAPL.O|150.60|1705323000000|1000000|150.10|150.75
   */
  validateMessage(rawMessage: string): ValidationResult {
    const errors: string[] = [];
    
    try {
      // Remove newline characters and trim whitespace
      const cleanMessage = rawMessage.replace(/\r?\n/g, '').trim();
      
      if (!cleanMessage) {
        return {
          isValid: false,
          errors: ['Empty message received']
        };
      }

      // Parse pipe-delimited format
      const parts = cleanMessage.split('|');
      
      if (parts.length !== 6) {
        return {
          isValid: false,
          errors: [`Invalid message format. Expected 6 parts, got ${parts.length}. Message: ${cleanMessage}`]
        };
      }

      const [ricStr, priceStr, timestampStr, volumeStr, bidStr, askStr] = parts;

      // Validate RIC (Reuters Instrument Code)
      const ric = this.validateRic(ricStr, errors);
      
      // Validate price (required)
      const price = this.validatePrice(priceStr, 'price', errors);
      
      // Validate timestamp (required)
      const timestamp = this.validateTimestamp(timestampStr, errors);
      
      // Validate optional fields
      const volume = this.validateOptionalNumber(volumeStr, 'volume', errors);
      const bid = this.validateOptionalNumber(bidStr, 'bid', errors);
      const ask = this.validateOptionalNumber(askStr, 'ask', errors);

      // If basic validation failed, return early
      if (errors.length > 0) {
        return {
          isValid: false,
          errors
        };
      }

      // Create the tick object
      const tick: PriceTick = {
        ric: ric!,
        price: price!,
        timestamp: timestamp!,
        ...(volume !== undefined && { volume }),
        ...(bid !== undefined && { bid }),
        ...(ask !== undefined && { ask })
      };

      // Perform business rule validations
      this.validateBusinessRules(tick, errors);

      // Update price tracking for future validations
      if (errors.length === 0) {
        this.lastPrices.set(tick.ric, tick.price);
      }

      return {
        isValid: errors.length === 0,
        tick: errors.length === 0 ? tick : undefined,
        errors
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Message parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  /**
   * Validate RIC (Reuters Instrument Code) format
   * Examples: AAPL.O, EUR=, BTC=, GOOGL.O
   */
  private validateRic(ricStr: string, errors: string[]): string | undefined {
    if (!ricStr || ricStr.trim() === '') {
      errors.push('RIC is required and cannot be empty');
      return undefined;
    }

    const ric = ricStr.trim();
    
    // Basic RIC format validation
    if (ric.length < 2) {
      errors.push(`RIC too short: ${ric}`);
      return undefined;
    }

    if (ric.length > 20) {
      errors.push(`RIC too long: ${ric}`);
      return undefined;
    }

    // RIC should contain only alphanumeric characters, dots, and equals signs
    if (!/^[A-Z0-9.=]+$/i.test(ric)) {
      errors.push(`Invalid RIC format: ${ric}. Only alphanumeric characters, dots, and equals signs are allowed`);
      return undefined;
    }

    return ric.toUpperCase(); // Normalize to uppercase
  }

  /**
   * Validate price field (required numeric value)
   */
  private validatePrice(priceStr: string, fieldName: string, errors: string[]): number | undefined {
    if (!priceStr || priceStr.trim() === '') {
      errors.push(`${fieldName} is required and cannot be empty`);
      return undefined;
    }

    const price = parseFloat(priceStr.trim());
    
    if (isNaN(price)) {
      errors.push(`Invalid ${fieldName}: ${priceStr}. Must be a valid number`);
      return undefined;
    }

    if (price <= 0) {
      errors.push(`Invalid ${fieldName}: ${price}. Must be greater than 0`);
      return undefined;
    }

    if (price > 1000000) {
      errors.push(`Invalid ${fieldName}: ${price}. Suspiciously high value`);
      return undefined;
    }

    return price;
  }

  /**
   * Validate timestamp field (required Unix timestamp in milliseconds)
   */
  private validateTimestamp(timestampStr: string, errors: string[]): number | undefined {
    if (!timestampStr || timestampStr.trim() === '') {
      errors.push('Timestamp is required and cannot be empty');
      return undefined;
    }

    const timestamp = parseInt(timestampStr.trim(), 10);
    
    if (isNaN(timestamp)) {
      errors.push(`Invalid timestamp: ${timestampStr}. Must be a valid Unix timestamp`);
      return undefined;
    }

    // Validate timestamp is reasonable (between 2020 and 2030)
    const minTimestamp = new Date('2020-01-01').getTime();
    const maxTimestamp = new Date('2030-01-01').getTime();
    
    if (timestamp < minTimestamp || timestamp > maxTimestamp) {
      errors.push(`Invalid timestamp: ${timestamp}. Must be between ${minTimestamp} and ${maxTimestamp}`);
      return undefined;
    }

    // Check if timestamp is too old (configurable age limit)
    const now = Date.now();
    const age = now - timestamp;
    
    if (age > this.config.validation.maxTimestampAge) {
      errors.push(`Timestamp too old: ${timestamp}. Age: ${age}ms, Max allowed: ${this.config.validation.maxTimestampAge}ms`);
      return undefined;
    }

    // Allow future timestamps within reason (up to 1 minute ahead)
    if (timestamp > now + 60000) {
      errors.push(`Timestamp too far in future: ${timestamp}. Current time: ${now}`);
      return undefined;
    }

    return timestamp;
  }

  /**
   * Validate optional numeric fields (volume, bid, ask)
   */
  private validateOptionalNumber(valueStr: string, fieldName: string, errors: string[]): number | undefined {
    if (!valueStr || valueStr.trim() === '') {
      return undefined; // Optional field, no error
    }

    const value = parseFloat(valueStr.trim());
    
    if (isNaN(value)) {
      errors.push(`Invalid ${fieldName}: ${valueStr}. Must be a valid number or empty`);
      return undefined;
    }

    if (value < 0) {
      errors.push(`Invalid ${fieldName}: ${value}. Cannot be negative`);
      return undefined;
    }

    if (fieldName === 'volume' && value > 1000000000) {
      errors.push(`Invalid ${fieldName}: ${value}. Suspiciously high volume`);
      return undefined;
    }

    if ((fieldName === 'bid' || fieldName === 'ask') && value > 1000000) {
      errors.push(`Invalid ${fieldName}: ${value}. Suspiciously high price`);
      return undefined;
    }

    return value;
  }

  /**
   * Validate business rules and detect anomalies
   */
  private validateBusinessRules(tick: PriceTick, errors: string[]): void {
    // Rule 1: Bid should be less than or equal to Ask
    if (tick.bid !== undefined && tick.ask !== undefined && tick.bid > tick.ask) {
      errors.push(`Invalid bid/ask spread: bid ${tick.bid} > ask ${tick.ask}`);
    }

    // Rule 2: Price should be within bid/ask spread if both are present
    if (tick.bid !== undefined && tick.ask !== undefined) {
      if (tick.price < tick.bid || tick.price > tick.ask) {
        errors.push(`Price ${tick.price} outside bid/ask spread [${tick.bid}, ${tick.ask}]`);
      }
    }

    // Rule 3: Check for significant price deviation from last known price
    const lastPrice = this.lastPrices.get(tick.ric);
    if (lastPrice !== undefined) {
      const deviation = Math.abs(tick.price - lastPrice) / lastPrice;
      if (deviation > this.config.validation.maxPriceDeviation) {
        const deviationPercent = (deviation * 100).toFixed(2);
        if (this.config.validation.strictMode) {
          errors.push(`Suspicious price change: ${deviationPercent}% deviation from last price ${lastPrice} to ${tick.price}`);
        } else {
          // Log warning but don't reject the message
          console.warn(`⚠️  Large price deviation for ${tick.ric}: ${deviationPercent}% (${lastPrice} → ${tick.price})`);
        }
      }
    }

    // Rule 4: Volume should make sense if present
    if (tick.volume !== undefined && tick.volume === 0) {
      if (this.config.validation.strictMode) {
        errors.push('Zero volume trades are not allowed in strict mode');
      }
    }
  }

  /**
   * Get validation statistics for monitoring
   */
  getValidationStats(): { [key: string]: number } {
    return {
      trackedSymbols: this.lastPrices.size,
      // Additional stats could be added here
    };
  }

  /**
   * Clear price tracking history (useful for testing or periodic cleanup)
   */
  clearPriceHistory(): void {
    this.lastPrices.clear();
  }

  /**
   * Get last known prices (for debugging/monitoring)
   */
  getLastPrices(): Map<string, number> {
    return new Map(this.lastPrices);
  }
}
