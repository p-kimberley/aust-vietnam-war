<?php
require('../../wp-blog-header.php');
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>

<?php
get_header();

$userID = $_GET['userID'];
?>

<!--BEGIN .author-bio-->
<div class="author-bio">
			<?php echo get_avatar( $userID, '90' ); ?>
			<div class="author-info">
				<h3 class="author-title">Written by <?php the_author_link(); ?></h3>
				<p class="author-description"><?php the_author_meta('description', $userID); ?></p>
				<p>Website: <a href="<?php the_author_meta('user_url', $userID);?>"><?php the_author_meta('user_url', $userID);?></a></p>
				<ul class="icons">
					<?php 
						$rss_url = get_the_author_meta( 'rss_url', $userID );
						if ( $rss_url && $rss_url != '' ) {
							echo '<li class="rss"><a href="' . esc_url($rss_url) . '"></a></li>';
						}
						
						$google_profile = get_the_author_meta( 'google_profile', $userID );
						if ( $google_profile && $google_profile != '' ) {
							echo '<li class="google"><a href="' . esc_url($google_profile) . '" rel="author"></a></li>';
						}
						
						$twitter_profile = get_the_author_meta( 'twitter_profile', $userID );
						if ( $twitter_profile && $twitter_profile != '' ) {
							echo '<li class="twitter"><a href="' . esc_url($twitter_profile) . '"></a></li>';
						}
						
						$facebook_profile = get_the_author_meta( 'facebook_profile', $userID );
						if ( $facebook_profile && $facebook_profile != '' ) {
							echo '<li class="facebook"><a href="' . esc_url($facebook_profile) . '"></a></li>';
						}
						
						$linkedin_profile = get_the_author_meta( 'linkedin_profile', $userID );
						if ( $linkedin_profile && $linkedin_profile != '' ) {
							echo '<li class="linkedin"><a href="' . esc_url($linkedin_profile) . '"></a></li>';
						}
					?>
				</ul>
			</div>
<!--END .author-bio-->
</div>

<?php
get_footer();
?>