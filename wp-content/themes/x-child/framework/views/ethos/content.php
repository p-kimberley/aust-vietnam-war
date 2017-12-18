<?php

// =============================================================================
// VIEWS/ETHOS/CONTENT.PHP
// -----------------------------------------------------------------------------
// Standard post output for Ethos.
// =============================================================================

$is_index_featured_layout = get_post_meta( get_the_ID(), '_x_ethos_index_featured_post_layout',  true ) == 'on' && ! is_single();

?>

<article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
  <?php if ( $is_index_featured_layout ) : ?>
    <?php x_ethos_featured_index(); ?>
  <?php else : ?>
    <?php if ( has_post_thumbnail() ) : ?>
      <div class="entry-featured">
        <?php if ( ! is_single() ) : ?>
          <?php x_ethos_featured_index(); ?>
        <?php else : ?>
          <?php x_featured_image(); ?>
        <?php endif; ?>
      </div>
    <?php endif; ?>
    <div class="entry-wrap">
      <?php x_get_view( 'ethos', '_content', 'post-header' ); ?>
      <?php x_get_view( 'global', '_content' ); ?>
	  
	  <?php
	  $class     = 'x-author-box cf';
	  $style     = '';
	  $title     = 'About the Author';
	  $author_id = get_the_author_meta( 'ID' );
	  $author_link = bp_core_get_userlink($author_id, $no_anchor = false, $just_link = true);
	
	  //$description  = get_the_author_meta( 'description', $author_id );
	  $field		= array('field' => 'About me', 'user_id' => $author_id);
	  $description	= bp_get_profile_field_data($field);
	  $display_name = get_the_author_meta( 'display_name', $author_id );
	  $facebook     = get_the_author_meta( 'facebook', $author_id );
	  $twitter      = get_the_author_meta( 'twitter', $author_id );
	  $googleplus   = get_the_author_meta( 'googleplus', $author_id );
	
	  $facebook_output   = ( $facebook )   ? "<a href=\"{$facebook}\" class=\"x-author-social\" title=\"Visit the Facebook Profile for {$display_name}\" target=\"_blank\"><i class=\"x-icon-facebook-square\"></i> Facebook</a>" : '';
	  $twitter_output    = ( $twitter )    ? "<a href=\"{$twitter}\" class=\"x-author-social\" title=\"Visit the Twitter Profile for {$display_name}\" target=\"_blank\"><i class=\"x-icon-twitter-square\"></i> Twitter</a>" : '';
	  $googleplus_output = ( $googleplus ) ? "<a href=\"{$googleplus}\" class=\"x-author-social\" title=\"Visit the Google+ Profile for {$display_name}\" target=\"_blank\"><i class=\"x-icon-google-plus-square\"></i> Google+</a>" : '';
	
	  $output = "<div {$id} class=\"{$class}\" {$style}>"
				. "<h6 class=\"h-about-the-author\">{$title}</h6>"
				. "<a href=\"{$author_link}\">" . get_avatar( $author_id, 180 ) . "</a>"
				. '<div class="x-author-info">'
				  . "<a href=\"{$author_link}\"><h4 class=\"h-author mtn\">{$display_name}</h4></a>"
					/*. $facebook_output
					. $twitter_output
					. $googleplus_output*/
				  . "<p class=\"p-author mbn\">{$description}</p>"
				. '</div>'
			  . '</div>';
	
	  echo $output;
	  ?>
	  
    </div>
  <?php endif; ?>
</article>