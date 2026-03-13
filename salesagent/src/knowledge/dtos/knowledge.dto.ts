import {
  IsString,
  IsUrl,
  IsOptional,
  IsArray,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDocumentFromUrlDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CrawlSiteDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxPages?: number; // default 20

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CreateDocumentFromTextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class DocumentListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  tags?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value as string, 10))
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value as string, 10))
  limit?: number;
}

export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  q: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Transform(({ value }) => parseInt(value as string, 10))
  topK?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  tags?: string[];
}
